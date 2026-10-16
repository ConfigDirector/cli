from configdirector.testing import create_test_client


def test_new_checkout_can_be_turned_off():
    with create_test_client({"new-checkout": True}) as test_client:
        test_client.set_value("new-checkout", False)
        assert test_client.client.get_value("new-checkout", True) is False
