# FestFlow HTTP API routes

Connect every route to the festflow-api integration. Use the exact path and method.

| Method | Path | Authorization |
| --- | --- | --- |
| GET | `/api/events` | None |
| GET | `/api/shows/{id}/availability` | None |
| GET | `/api/me` | JWT + openid |
| POST | `/api/holds` | JWT + openid |
| GET | `/api/bookings` | JWT + openid |
| GET | `/api/bookings/{id}` | JWT + openid |
| POST | `/api/bookings/{id}/payment` | JWT + openid |
| POST | `/api/bookings/{id}/cancel` | JWT + openid |
| GET | `/api/bookings/{id}/ticket` | JWT + openid |
| GET | `/api/venue/{id}/bookings` | JWT + openid |
| PATCH | `/api/venue/{id}/shows/{show}` | JWT + openid |
| PATCH | `/api/venue/{id}/shows/{show}/seats/{seat}` | JWT + openid |
| POST | `/api/venue/{id}/check-in` | JWT + openid |
| GET | `/api/kitchen/{id}/orders` | JWT + openid |
| PATCH | `/api/kitchen/{id}/orders/{order}` | JWT + openid |
| GET | `/api/admin/audit` | JWT + openid |
| PUT | `/api/admin/operators/{sub}` | JWT + openid |
