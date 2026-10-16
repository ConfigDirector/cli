import 'package:configdirector_flutter_client_sdk/testing.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('reads the new checkout flag', () async {
    final testClient = createTestClient(values: {'new-checkout': true});
    await testClient.client.initialize();
    expect(testClient.client.getValue('new-checkout', false), isTrue);
    testClient.setValue('new-checkout', false);
  });
}
