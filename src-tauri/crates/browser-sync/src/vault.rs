//! The vault link: copies each profile's local records to and from the server, sealed under keys
//! only this account's clients hold. Everything it needs is in the local store, so sync can pause,
//! stop or be destroyed without touching what's on this computer.
pub mod client;
pub mod codec;
pub mod exchange;
pub mod keys;
pub mod link;
