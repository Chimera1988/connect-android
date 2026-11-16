"""Final release gate. Public certificate metadata only; never print keytool output."""
import os
import re
import subprocess
DEBUG_CERT = 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c'
def validate_certificate(actual, expected, owner):
    actual = actual.replace(':', '').lower()
    expected = expected.replace(':', '').lower()
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('Expected installed certificate fingerprint is required')
    if actual != expected:
        raise ValueError('Signing certificate differs from the existing application')
    if actual == DEBUG_CERT or 'android debug' in owner.lower():
        raise ValueError('Existing certificate is an Android debug certificate, unsuitable for final release; changing it would break in-place updates')
if __name__ == '__main__':
    result = subprocess.check_output(['keytool', '-list', '-v', '-keystore',
        os.environ['CONNECT_RELEASE_KEYSTORE_FILE'], '-alias', os.environ['CONNECT_RELEASE_KEY_ALIAS'],
        '-storepass:env', 'CONNECT_RELEASE_STORE_PASSWORD', '-J-Duser.language=en'], text=True, stderr=subprocess.PIPE)
    digest = re.search(r'SHA256:\s*([0-9A-Fa-f:]+)', result)
    owner = re.search(r'Owner:\s*(.*)', result)
    if not digest or not owner:
        raise SystemExit('Cannot verify existing signing certificate')
    validate_certificate(digest[1], os.environ.get('CONNECT_PREVIOUS_CERT_SHA256', ''), owner[1])
    print('Existing non-debug release signing certificate verified')
