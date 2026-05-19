# Security Policy

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Report security issues privately via one of these channels:

- **Email**: security@aakd.com
- **GitHub Private Advisory**: [Report a vulnerability](../../security/advisories/new)

Include as much detail as possible:
- Description of the vulnerability
- Steps to reproduce
- Affected versions
- Potential impact

You will receive an acknowledgement within 48 hours and a more detailed response within 7 days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest `main` | Yes |
| older releases | Security fixes backported on a case-by-case basis |

## Disclosure Policy

We follow coordinated disclosure. Once a fix is confirmed and released, you are welcome to publish your findings. Please give us reasonable time to patch before public disclosure.

## Scope

The following are in scope:
- Authentication and session management
- Multi-tenant org isolation (data leakage between orgs)
- API key storage and validation
- File upload validation and storage
- SQL injection, XSS, CSRF
- Dependency vulnerabilities with known exploits

Out of scope:
- Issues requiring physical access to the server
- Social engineering
- Denial of service via resource exhaustion
