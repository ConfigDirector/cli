using Microsoft.Extensions.Configuration;

public class Settings(IConfiguration configuration)
{
    public bool Verbose => configuration.GetValue<bool>("VerboseLogging", false);
}
