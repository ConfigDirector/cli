from app.legacy_flag_service import legacy_flags

LEGACY_DARK_MODE = legacy_flags.get_boolean_value("legacy-dark-mode", False)
