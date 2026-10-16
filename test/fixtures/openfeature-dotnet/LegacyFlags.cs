public static class LegacyFlags
{
    public static Task<bool> DarkMode() => LegacyFlagService.Instance.GetBooleanValueAsync("legacy-dark-mode", false);
}
