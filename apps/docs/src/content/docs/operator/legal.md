---
title: Legal wording and personal data
description: Customer-designed goods and the data you hold.
---

**Withdrawal Notice.** Goods made to a Customer's design are exempt from the EU/UK 14-day right of withdrawal; Pressline shows a notice on the design page and has Stripe collect consent to it at checkout, and records the acceptance time on the Order. The default wording is a starting point: review `legal.withdrawalNotice`, your terms and your privacy policy with counsel for the countries you ship to. Defective or damaged items are always replaced.

**Personal data.** An Order holds the Recipient (name, address, email, phone) and the consent time. `pressline orders purge --older-than <days>` strips both from finished Orders older than that, leaving country and totals for your books. Stripe and Printful keep their own records under their own terms.
