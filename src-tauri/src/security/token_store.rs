use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "ommapin";
const USERNAME: &str = "pinboard_auth_token";

#[derive(Debug, thiserror::Error)]
pub enum TokenStoreError {
    #[error("system keyring is unavailable or locked (Secret Service): {0}")]
    StorageUnavailable(String),
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
            .map_err(Self::map_keyring_error)
    }

    pub fn get_token(&self) -> Result<Option<String>, TokenStoreError> {
        let entry =
            Entry::new(SERVICE, USERNAME).map_err(|e| TokenStoreError::Keyring(e.to_string()))?;

        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(err) => Err(Self::map_keyring_error(err)),
        }
    }

    pub fn clear_token(&self) -> Result<(), TokenStoreError> {
        let entry =
            Entry::new(SERVICE, USERNAME).map_err(|e| TokenStoreError::Keyring(e.to_string()))?;

        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(Self::map_keyring_error(err)),
        }
    }

    fn map_keyring_error(error: KeyringError) -> TokenStoreError {
        match error {
            KeyringError::NoStorageAccess(inner) => {
                TokenStoreError::StorageUnavailable(inner.to_string())
            }
            other => TokenStoreError::Keyring(other.to_string()),
        }
    }
}
