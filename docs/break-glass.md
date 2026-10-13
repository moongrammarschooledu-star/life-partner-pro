# Break-glass (STEP 36)

Platform break-glass is a **time-limited exception to the production change freeze**. It is not a way to gain permissions.

## What it does

* Lets the one administrator who holds it make configuration changes while a freeze is active.
* Lasts 5 to 60 minutes (default 30) and ends earlier if the administrator ends it.
* Is only available **during a freeze** (otherwise it is refused: there is nothing to bypass).
* Is held by one named administrator. Others are still blocked.

## What it never does

* Never changes the administrator's role or grants any permission. They need `platform:break_glass` to take it, and the permission to make the change they want to make.
* Never touches the older record-level break-glass used to view one contact or case; that is a separate mechanism and is unchanged.

## Requirements to take it

`platform:break_glass`, a reason of at least 10 characters, the environment named, a fresh password confirmation (the administrator has also passed sign-in two-factor).

## Audit and review

* Granting and ending are audited; **each change made under it** writes an enhanced audit row and increments the use count on the event.
* Every use must be **reviewed by a different administrator** after it ends or expires. You cannot review your own, cannot review while it is still active, and cannot review twice. Un-reviewed uses are counted on the Control Center overview.
* The Maintenance page lists every event with who, when, until, how many changes, and review status.

## When to use it

For a genuine emergency that cannot wait for the freeze to end and that is not a simple switch-off (switching something off is already allowed during a freeze for anyone holding `platform:change_freeze`). Examples: correcting wrong public contact details during a release freeze; re-enabling a feature after an incident.
