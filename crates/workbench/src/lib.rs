//! Desktop workbench Host; the independent process owns all execution state.
mod files;
mod plugins;
mod projection;
mod providers;
mod server;
mod state;

pub use providers::find_node;
pub use server::serve;
