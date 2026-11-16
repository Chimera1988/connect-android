import unittest
from check_release_signing import validate_certificate
class SigningPolicy(unittest.TestCase):
    def test_valid_existing_release(self):
        validate_certificate('a'*64, 'a'*64, 'CN=Connect')
    def test_mismatch_is_never_an_update(self):
        with self.assertRaisesRegex(ValueError, 'differs'):
            validate_certificate('a'*64, 'b'*64, 'CN=Connect')
    def test_debug_is_not_a_final_release(self):
        for fingerprint, owner in [('fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c','CN=Connect'), ('a'*64, 'CN=Android Debug, O=Android')]:
            with self.assertRaisesRegex(ValueError, 'debug'):
                validate_certificate(fingerprint, fingerprint, owner)
    def test_unknown_installed_certificate_is_not_compatibility_proof(self):
        with self.assertRaises(ValueError):
            validate_certificate('a'*64, '', 'CN=Connect')
