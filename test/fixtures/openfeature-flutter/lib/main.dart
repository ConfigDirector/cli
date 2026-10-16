import 'package:configdirector_openfeature_flutter_provider/configdirector_openfeature_flutter_provider.dart';
import 'package:openfeature_dart_client_sdk/openfeature_dart_client_sdk.dart';

Future<void> main() async {
  final provider = ConfigDirectorProvider(clientSdkKey: 'YOUR-CLIENT-SDK-KEY');
  await OpenFeatureAPI.instance.setProviderAndWait(provider);
  final client = OpenFeatureAPI.instance.getClient();

  final booleanValue = client.getBooleanValue('my-config-key', false);

  final stringValue = client.getStringValue('my-string-config-key', 'Default');

  final limits = client.getStructureValue('rate-limits', {'perMinute': 60});
}
