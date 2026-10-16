import 'config_director_setup.dart';

// Retrieve the current value
final value = client.getValue('my-config-key', false);

// Subscribe to value updates
final subscription = client.watch('my-config-key', false).listen((newValue) {
  debugPrint('Value updated: $newValue');
});

await subscription.cancel(); // Cancel the subscription to remove the listener

client.unwatch('my-config-key'); // Closes every stream watching that key

final maxItems = client.evaluate<int>('max-items', 20);
