# SPBC build plan: 40 approved upgrades (Remy, 2026-11-24)

Status key: [ ] todo · [x] built + tested locally · (needs Remy) = an input only Remy can give.
Not wanted (do not build): show-me-source unpaid-invoice alarm, passing supplier deals on,
monthly report/CSV, "ask for a product" box, store credit.

## Batch 1: prices, checkout and shop
- [ ] 1. Prices round to the nearest whole dollar (sync formula; IPA 10MG $37.50 -> $38)
- [ ] 2. Shipping speed choice at checkout (Standard / Priority; SPBC fill picks the matching show-me-source option)
- [ ] 3. Stock caps from show-me-source max quantity + "only N left"
- [ ] 4. Delivery notes at checkout (SPBC fill pastes them into show-me-source's notes)
- [ ] 5. Address check (ZIP vs city/state) before ordering
- [ ] 6. "Best seller" badges + sort by popular (from real sales)
- [ ] 7. Duplicate order catch (same cart + email within minutes)
- [ ] 8. Bot protection on checkout + forms (Cloudflare Turnstile) (needs Remy: OK to create the free widget)
- [ ] 9. Checkout problem reports (front-end errors / failed checkouts logged for the admin)
- [ ] 10. "Ships Monday" notices on weekends and USPS holidays
- [ ] 11. Vacation mode (pause checkout with a message)
- [ ] 12. Shop announcement banner (set in admin)
- [ ] 13. Sales tax setting (off by default; MO rate when turned on)
- [ ] 14. Faster on phones (lighter hero video / data saver, speed + accessibility pass)

## Batch 2: admin tools
- [ ] 15. One-click "Add to shop" for new show-me-source products (with rename)
- [ ] 16. Customer notes and tags
- [ ] 17. One-tap customer messages (templates, sent from orders@, logged)
- [ ] 18. Admin as a phone app (installable, "to do" view)
- [ ] 19. Search everything (name/email/phone/order)
- [ ] 20. Change log with Undo (prices, settings, products)
- [ ] 21. Bulk edit on the Price list
- [ ] 22. Margin on the Price list (today's supplier cost, your price, profit $ and %)
- [ ] 23. Price history per product
- [ ] 24. Supplier bill check (charged vs expected at pricing-code prices)
- [ ] 25. Suspicious order flags
- [ ] 26. Two-step admin login (authenticator app)
- [ ] 27. Alert when the supplier sync breaks

## Batch 3: customer pages
- [ ] 28. Reviews from real buyers (request after delivery, Remy approves, shown on shop)
- [ ] 29. "My orders" (email one-time link, all orders + order again)
- [ ] 30. Contact form (bot-protected, lands in admin + email)
- [ ] 31. Customers cancel their own unpaid order (Track page)
- [ ] 32. Downloadable receipts (Track page)
- [ ] 33. Lab report library page (once lab reports are on)
- [ ] 34. Privacy page + automatic data clean-up (period Remy picks)
- [ ] 35. Unsubscribe links + email preferences on promo emails

## Batch 4: email, money, backups
- [ ] 36. Instant alert when a customer pays
- [ ] 37. Chime + PayPal readers in the Money tab (needs Remy: one sample of each to supplier@)
- [ ] 38. Auto-mark delivered from USPS tracking (needs Remy: free USPS developer sign-up)
- [ ] 39. support@springfieldpbc.com forwarded to Outlook, used on the site
- [ ] 40. Off-site copy of the weekly backup (Google Drive)
