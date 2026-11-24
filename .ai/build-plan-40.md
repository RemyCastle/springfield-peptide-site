# SPBC build plan: 40 approved upgrades (Remy, 2026-11-24)

Status key: [ ] todo · [~] code ready, needs a Remy step · [x] built + tested locally (not deployed) · (needs Remy) = an input only Remy can give.
Not wanted (do not build): show-me-source unpaid-invoice alarm, passing supplier deals on,
monthly report/CSV, "ask for a product" box, store credit.

## Batch 1: prices, checkout and shop
- [x] 1. Prices round to the nearest whole dollar (sync formula; IPA 10MG $37.50 -> $38)
- [x] 2. Shipping speed choice at checkout (Standard / Priority; SPBC fill picks the matching show-me-source option)
- [x] 3. Stock caps from show-me-source max quantity + "only N left"
- [x] 4. Delivery notes at checkout (SPBC fill pastes them into show-me-source's notes)
- [x] 5. Address check (ZIP vs city/state) before ordering
- [x] 6. "Best seller" badges + sort by popular (from real sales)
- [x] 7. Duplicate order catch (same cart + email within minutes)
- [~] 8. Bot protection on checkout + forms (Cloudflare Turnstile) (needs Remy: OK to create the free widget)
- [x] 9. Checkout problem reports (front-end errors / failed checkouts logged for the admin)
- [x] 10. "Ships Monday" notices on weekends and USPS holidays
- [x] 11. Vacation mode (pause checkout with a message)
- [x] 12. Shop announcement banner (set in admin)
- [x] 13. Sales tax setting (off by default; MO rate when turned on)
- [x] 14. Faster on phones (lighter hero video / data saver, speed + accessibility pass)

## Batch 2: admin tools
- [x] 15. One-click "Add to shop" for new show-me-source products (with rename)
- [x] 16. Customer notes and tags
- [x] 17. One-tap customer messages (templates, sent from orders@, logged)
- [x] 18. Admin as a phone app (installable, "to do" view)
- [x] 19. Search everything (name/email/phone/order)
- [x] 20. Change log with Undo (prices, settings, products)
- [x] 21. Bulk edit on the Price list
- [x] 22. Margin on the Price list (today's supplier cost, your price, profit $ and %)
- [x] 23. Price history per product
- [x] 24. Supplier bill check (charged vs expected at pricing-code prices)
- [x] 25. Suspicious order flags
- [x] 26. Two-step admin login (authenticator app)
- [x] 27. Alert when the supplier sync breaks

## Batch 3: customer pages
- [x] 28. Reviews from real buyers (request after delivery, Remy approves, shown on shop)
- [x] 29. "My orders" (email one-time link, all orders + order again)
- [x] 30. Contact form (bot-protected, lands in admin + email)
- [x] 31. Customers cancel their own unpaid order (Track page)
- [x] 32. Downloadable receipts (Track page)
- [x] 33. Lab report library page (once lab reports are on)
- [x] 34. Privacy page + automatic data clean-up (period Remy picks)
- [x] 35. Unsubscribe links + email preferences on promo emails

## Batch 4: email, money, backups
- [x] 36. Instant alert when a customer pays
- [ ] 37. Chime + PayPal readers in the Money tab (needs Remy: one sample of each to supplier@)
- [ ] 38. Auto-mark delivered from USPS tracking (needs Remy: free USPS developer sign-up)
- [~] 39. support@springfieldpbc.com forwarded to Outlook, used on the site
- [x] 40. Off-site copy of the weekly backup (Google Drive)

## Status 2026-11-24 (all local, nothing deployed)
- Commits on feat/sms-dropship: 27960a6, d57047f, 683f587 (batch 1), 4279022, 5f88412 (batch 2), 42ee238 (batch 3), 20e3d2a (batch 4).
- 8 Turnstile: code ready; widget not created (needs Remy's OK), then TURNSTILE_SITE_KEY + TURNSTILE_SECRET on Pages.
- 14 Phones: checked; hero video already skipped on data saver / reduced motion, no blocking scripts. No big change needed.
- 36 Payment alert: switch "Email me the moment a Venmo payment arrives" (pay_alert_on).
- 37 Chime/PayPal readers: waiting for one sample email of each at supplier@.
- 38 USPS auto-delivered: waiting for Remy's free USPS developer sign-up.
- 39 support@: only verified forwarding address is a Gmail; Remy must verify Outlook once, then add the rule and swap the site email.
- 40 Backup: Google Drive for desktop is not installed, so the copy goes to OneDrive\Backups\SPBC (switches to Google Drive automatically if installed).
- Site emails from Pages (messages, My orders links, contact alerts, review alerts) need RESEND_API_KEY as a Pages secret too.
- Switches that start OFF: reviews_on, pay_alert_on, cleanup_months=0, vacation, tax.
