<?php

declare(strict_types=1);

namespace App;

use ConfigDirector\ConfigDirectorClient;
use ConfigDirector\Context;

final readonly class CheckoutService
{
    public function __construct(private ConfigDirectorClient $client) {}

    public function isNewCheckoutEnabled(string $userId): bool
    {
        return $this->client->getValue('new-checkout', false, new Context(id: $userId));
    }
}
