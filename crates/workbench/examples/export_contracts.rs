fn main() {
    println!(
        "{}",
        serde_json::to_string_pretty(&vibeone_workbench::contracts::schemas()).unwrap()
    );
}
