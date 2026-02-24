use keyring::Entry;

const SERVICE: &str = "ommapin";
const USERNAME: &str = "pinboard_auth_token";

#[derive(Debug, thiserror::Error)]
pub enum TokenStoreError {
    #[error("failed to access keyring: {0}")]
    Keyring(String),
}

pub struct TokenStore;

impl TokenStore {
    pub fn new() -> Self {
        Self
    }

    pub fn set_token(&self, token: &str) -> Result<(), TokenStoreError> {
        Entry::new(SERVICE, USERNAME)
            .map_err(|e| TokenStoreError::Keyring(e.to_string()))?
            .set_password(token)
            .map_err(|e| TokenStoreError::Keyring(e.to_string()))
    }

    pub fn get_token(&self) -> Result<Option<String>, TokenStoreError> {
        let entry =
            Entry::new(SERVICE, USERNAME).map_err(|e| TokenStoreError::Keyring(e.to_string()))?;

        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(TokenStoreError::Keyring(err.to_string())),
        }
    }

    pub fn clear_token(&self) -> Result<(), TokenStoreError> {
        let entry =
            Entry::new(SERVICE, USERNAME).map_err(|e| TokenStoreError::Keyring(e.to_string()))?;

        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(TokenStoreError::Keyring(err.to_string())),
        }
    }
}
