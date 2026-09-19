# Owner's local recovery-key check

This check is **pending until the owner runs it on their Windows computer**.
CI with disposable identities can validate the helper but cannot validate the
owner's key. The helper uses no network, production records, R2 objects or cloud
credentials. It does not activate backups or change settings.

## What it verifies

1. Derive the public recipient from the existing private age identity.
2. Compare it exactly with the public recipient configured for backups.
3. Generate 256 random dummy bytes, encrypt using that recipient, decrypt using
   the local identity, and compare SHA-256 hashes.
4. Remove the temporary dummy files and print a small JSON receipt.

The identity file is never modified, copied or printed. Do not send the private
identity or a password to chat, GitHub, Vercel, or this repository. The receipt
contains only a public recipient, UTC timestamp and check results.

## Windows PowerShell 5.1

Run the repository's reviewed `scripts\backup\verify-owner-key.ps1` from a local
checkout. `age.exe` and `age-keygen.exe` must already be installed in the same
directory. This helper does not install software or change execution policy.

```powershell
.\scripts\backup\verify-owner-key.ps1 -ExpectedRecipient '<configured age1 public recipient>'
```

Use the **existing configured public recipient**, not a newly generated key. Its
value should be supplied from the `lino-backup` environment's public recipient
variable after checking it. The default private identity path is
`$env:USERPROFILE\LiNo-backup-keys\backup-key.txt`.

If age is not on PATH, point to the already installed executable:

```powershell
.\scripts\backup\verify-owner-key.ps1 -ExpectedRecipient '<configured age1 public recipient>' -AgeExe 'C:\path\to\age.exe'
```

`-IdentityPath` can override the existing identity location. Use an unencrypted
age identity file; the encrypted `.age` copy is a separate key backup, not the
identity input. If PowerShell blocks execution, report the error rather than
changing execution policy as part of this procedure.

Success prints `"status":"passed"`. Share that receipt only. Failure identifies
the stage without printing native stderr or private identity contents. No
success receipt is emitted if recipient comparison, encryption, decryption,
hash comparison or normal cleanup fails. Any failed temporary-directory cleanup
may leave random dummy data only; the identity remains in its original location.

## Limits and automated coverage

This proves local possession of the identity matching the configured recipient.
It does **not** prove retrieval of a cloud backup, database restoration, managed
Supabase compatibility, recovery of the separately encrypted identity copy, or
readiness to activate production backups.

Automated Windows coverage should run with ephemeral age keys and verify:
successful roundtrip, a different valid recipient, missing identity/executable,
native failure, malformed ciphertext or incorrect decrypted data, paths with
spaces, and absence of private identity text in output. It must use no owner key,
cloud secrets or production data.
