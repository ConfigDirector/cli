<?php

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use ConfigDirector\ConfigDirector;
use ConfigDirector\Context;
use ConfigDirector\Metadata;

// The server SDK key is a secret. Do not commit it to your source code.
$client = ConfigDirector::createClient(
    serverSdkKey: 'YOUR-SERVER-SDK-KEY',
    metadata: new Metadata(appName: 'my-awesome-app', appVersion: '1.0.0'),
);

$context = new Context(id: 'user-123', name: 'Ada Lovelace');

# Watch for config updates
$stopWatching = $client->watch(
    'max-items',
    20,
    function (int $maxItems): void {
        // Called with the config's value when the client first gets it, and again each time the config changes.
    },
    $context,
);

$client->initialize();

// Retrieve config values
$newCheckout = $client->getValue('new-checkout', false, $context);
$theme = $client->getValue(configKey: 'theme', defaultValue: 'light', context: $context);
$rateLimits = $client->getValue('rate-limits', ['per_minute' => 60], $context);
$evaluation = $client->evaluate('checkout-button-color', 'blue', $context);

$stopWatching();
$client->unwatch('max-items');
