use serde_json::{Value, json};

#[tauri::command]
pub async fn notification_permission() -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    return macos::permission().await;
    #[cfg(not(target_os = "macos"))]
    Ok(json!({"status":"unavailable","source":"platform"}))
}

#[tauri::command]
pub async fn request_notification_permission() -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    return macos::request().await;
    #[cfg(not(target_os = "macos"))]
    Ok(json!({"status":"unavailable","source":"platform"}))
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSError;
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNNotificationSettings,
        UNUserNotificationCenter,
    };
    use std::{ptr::NonNull, sync::Mutex, time::Duration};
    use tokio::sync::oneshot;

    pub(super) async fn permission() -> Result<Value, String> {
        let (sender, receiver) = oneshot::channel();
        {
            let sender = Mutex::new(Some(sender));
            let callback = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                // The system owns settings for the duration of its completion handler.
                let status = unsafe { settings.as_ref() }.authorizationStatus();
                let status = match status {
                    UNAuthorizationStatus::NotDetermined => "default",
                    UNAuthorizationStatus::Denied => "denied",
                    UNAuthorizationStatus::Authorized => "granted",
                    UNAuthorizationStatus::Provisional => "provisional",
                    UNAuthorizationStatus::Ephemeral => "ephemeral",
                    _ => "unknown",
                };
                if let Some(sender) = sender
                    .lock()
                    .expect("notification callback poisoned")
                    .take()
                {
                    let _ = sender.send(status);
                }
            });
            UNUserNotificationCenter::currentNotificationCenter()
                .getNotificationSettingsWithCompletionHandler(&callback);
        }
        let status = tokio::time::timeout(Duration::from_secs(10), receiver)
            .await
            .map_err(|_| "系统通知权限查询超时")?
            .map_err(|_| "系统通知权限查询未返回")?;
        Ok(json!({"status":status,"source":"macOS UserNotifications"}))
    }

    pub(super) async fn request() -> Result<Value, String> {
        let (sender, receiver) = oneshot::channel();
        {
            let sender = Mutex::new(Some(sender));
            let callback = RcBlock::new(move |_granted: Bool, error: *mut NSError| {
                if let Some(sender) = sender
                    .lock()
                    .expect("notification callback poisoned")
                    .take()
                {
                    let _ = sender.send(error.is_null());
                }
            });
            UNUserNotificationCenter::currentNotificationCenter()
                .requestAuthorizationWithOptions_completionHandler(
                    UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                    &callback,
                );
        }
        let succeeded = tokio::time::timeout(Duration::from_secs(120), receiver)
            .await
            .map_err(|_| "系统通知授权尚未完成，请关闭弹窗后重试")?
            .map_err(|_| "系统通知授权未返回")?;
        if !succeeded {
            return Err("系统通知授权失败，请检查系统设置后重试".into());
        }
        permission().await
    }
}
