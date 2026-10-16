using ConfigDirector.Testing;
using Xunit;

public class CheckoutTests
{
    [Fact]
    public async Task NewCheckoutCanBeTurnedOff()
    {
        await using var testClient = ConfigDirectorTesting.CreateTestClient(
            new Dictionary<string, object> { ["new-checkout"] = true });
        testClient.SetValue("new-checkout", false);
    }
}
