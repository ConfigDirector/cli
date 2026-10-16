from configdirector_openfeature import ConfigDirectorProvider
from openfeature import api

api.set_provider_and_wait(ConfigDirectorProvider("YOUR-SERVER-SDK-KEY"))
client = api.get_client()

boolean_value = client.get_boolean_value("my-config-key", False)

string_value = client.get_string_value("my-string-config-key", "Default")


async def sample_ratio() -> float:
    return await client.get_float_value_async("sample-ratio", 0.25)
