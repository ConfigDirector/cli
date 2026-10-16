import 'legacy_flag_service.dart';

bool darkMode() => legacyFlags.getBooleanValue('legacy-dark-mode', false);
