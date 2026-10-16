import 'package:configdirector_flutter_client_sdk/configdirector_flutter_client_sdk.dart';

final client = ConfigDirectorClient(clientSdkKey: 'YOUR-CLIENT-SDK-KEY');

await client.initialize();
