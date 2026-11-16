<?php

declare(strict_types=1);

namespace App\Tests;

use App\CheckoutService;
use ConfigDirector\Testing\ConfigDirectorTesting;
use PHPUnit\Framework\TestCase;

final class CheckoutServiceTest extends TestCase
{
    public function testTheNewCheckoutFollowsItsFlag(): void
    {
        $testClient = ConfigDirectorTesting::createTestClient(values: ['new-checkout' => true]);
        $service = new CheckoutService($testClient->client);
        $testClient->client->initialize();

        self::assertTrue($service->isNewCheckoutEnabled('user-123'));

        $testClient->setValue('new-checkout', false);
        self::assertFalse($service->isNewCheckoutEnabled('user-123'));

        $testClient->removeValue('new-checkout');
        $testClient->replaceValues(['max-items' => 20]);
    }
}
