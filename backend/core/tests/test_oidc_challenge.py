from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from django.db import connections
from django.test import TransactionTestCase

from core.oidc import challenge
from core.oidc.models import LoginChallenge
from core.tests.test_oidc_signin import Issuer


class ChallengeConsumptionTests(TransactionTestCase):
    def test_two_callbacks_for_the_same_session_get_one_verifier(self):
        provider = Issuer().config
        session = {}
        state, nonce, _ = challenge.start(session, provider)
        barrier = Barrier(2)

        def consume():
            try:
                barrier.wait(timeout=10)
                return challenge.consume(session.copy(), provider, state)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(consume) for _ in range(2)]
            results = [future.result(timeout=15) for future in futures]
        accepted = [result for result in results if result is not None]
        self.assertEqual([result[0] for result in accepted], [nonce])
        self.assertFalse(LoginChallenge.objects.exists())
