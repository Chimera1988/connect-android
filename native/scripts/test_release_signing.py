import unittest
from check_release_signing import validate_certificate, read_apksigner_fingerprint
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

class SigningOutputFormats(unittest.TestCase):
    def test_apksigner_current_v2_format(self):
        output = 'Number of signers: 1\nV2 Signer: certificate SHA-256 digest: ' + 'a'*64 + '\n'
        self.assertEqual(read_apksigner_fingerprint(output), 'a'*64)
    def test_apksigner_versioned_numbered_format(self):
        output = 'V2 Signer #1 certificate SHA-256 digest: ' + 'a'*64 + '\n'
        self.assertEqual(read_apksigner_fingerprint(output), 'a'*64)
    def test_apksigner_legacy_format(self):
        output = 'Signer #1 certificate SHA-256 digest: ' + 'b'*64 + '\n'
        self.assertEqual(read_apksigner_fingerprint(output), 'b'*64)
    def test_matching_v2_v3_is_allowed(self):
        output = 'V2 Signer: certificate SHA-256 digest: ' + 'a'*64 + '\nV3 Signer: certificate SHA-256 digest: ' + 'a'*64
        self.assertEqual(read_apksigner_fingerprint(output), 'a'*64)
    def test_different_certificates_are_rejected(self):
        output = 'V2 Signer: certificate SHA-256 digest: ' + 'a'*64 + '\nV3 Signer: certificate SHA-256 digest: ' + 'b'*64
        with self.assertRaises(ValueError):
            read_apksigner_fingerprint(output)
    def test_missing_or_multiple_signers_are_rejected(self):
        with self.assertRaises(ValueError):
            read_apksigner_fingerprint('Number of signers: 0')
        with self.assertRaises(ValueError):
            read_apksigner_fingerprint('Number of signers: 2\nV2 Signer: certificate SHA-256 digest: ' + 'a'*64)
