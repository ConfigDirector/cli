from app.settings_store import store

SESSION_TIMEOUT = store.get_value("session-timeout", 30)
