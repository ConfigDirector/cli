<?php

declare(strict_types=1);

require __DIR__ . '/vendor/autoload.php';

use ConfigDirector\Metadata;
use ConfigDirector\OpenFeature\ConfigDirectorProvider;
use OpenFeature\OpenFeatureAPI;
use OpenFeature\implementation\flags\Attributes;
use OpenFeature\implementation\flags\EvaluationContext;

// The server SDK key is a secret. Do not commit it to your source code.
$api = OpenFeatureAPI::getInstance();
$api->setProvider(new ConfigDirectorProvider(
    serverSdkKey: 'YOUR-SERVER-SDK-KEY',
    metadata: new Metadata(appName: 'my-awesome-app', appVersion: '1.0.0'),
));
$client = $api->getClient();

$user = new EvaluationContext('user-123', new Attributes(['name' => 'Ada', 'traits' => ['plan' => 'pro']]));

$newCheckout = $client->getBooleanValue('new-checkout', false, $user);
$theme = $client->getStringValue('theme', 'light', $user);
$maxItems = $client->getIntegerDetails('max-items', 20, $user);
$discount = $client->getFloatValue('checkout-discount', 0.1, $user);
$rateLimits = $client->getObjectValue(flagKey: 'rate-limits', defaultValue: ['per_minute' => 60], context: $user);
