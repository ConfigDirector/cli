using ConfigDirector;

public record Theme(string AccentColor);

public class Checkout(IConfigDirectorClient client)
{
    private static readonly Theme fallback = new("blue");

    public bool BannerShown(Context context) => (bool)client.Evaluate("checkout-banner", false, context).Value;

    public object PageSize() => client.Evaluate(configKey: "page-size", defaultValue: 20).Value;

    public object CurrentTheme() => client.EvaluateJson<Theme>("theme", fallback).Value;
}
