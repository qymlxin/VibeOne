# 桌面窗口标题栏

Electron窗口使用hiddenInset标题栏。React的windowbar通过CSS `-webkit-app-region: drag`提供拖动区域；按钮、输入框、菜单及项目切换器使用`no-drag`保留交互。窗口控制由Electron管理，不再包含Tauri拖动属性或事件处理。
