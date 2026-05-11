# Auth Testing Guide

## Roles
- **Productor** (admin): full access, user management
- **Almacén**: warehouse, can modify material/flightcases/vehicles, no event ficha edit, can close + export
- **Técnico**: read-only, only sees own assigned events, can create incidents, can export PDF

## Admin
- Email: iantecnicosonido@gmail.com
- Initial Password: EdisonBryan2026!
- Role: productor

## Endpoints
- POST /api/auth/login {email, password} → user + sets cookies
- POST /api/auth/logout → clears cookies
- GET /api/auth/me → current user
- POST /api/auth/register (productor only) {email, password, name, role}
- POST /api/auth/change-password {old, new}
- POST /api/auth/forgot-password {email} → logs token to console
- POST /api/auth/reset-password {token, password}
- GET /api/users (productor only)
- PUT /api/users/{id} (productor only)
- DELETE /api/users/{id} (productor only)

## Authorization
- Cookie httpOnly (access_token 15 min, refresh_token 7 days)
- Bearer fallback for testing
- Each protected endpoint uses `Depends(get_current_user)` or `require_role(...)`

## Curl Quick Test
```
curl -c c.txt -X POST $URL/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"iantecnicosonido@gmail.com","password":"EdisonBryan2026!"}'
curl -b c.txt $URL/api/auth/me
```
