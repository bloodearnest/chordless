-- The link in the sign-in email (/sign-in/<id>): its id is random and means nothing, and this row says who it is for.
-- The address, the code and the page to go on to are kept here, readable, until the link or the code is used, a new
-- code replaces them, or the three days are up (the next request for a code deletes what has run out): the address
-- is already held for as long as there is a membership or an invite, and the code is a six-digit secret that works
-- for five tries. link_hash is a keyed hash of the id, so the id itself is not kept.
--
-- Only additive: the Worker before this one carries on without the columns. Back the database up first (just db-backup).

ALTER TABLE login_codes ADD COLUMN link_hash TEXT;
ALTER TABLE login_codes ADD COLUMN address TEXT;
ALTER TABLE login_codes ADD COLUMN code TEXT;
ALTER TABLE login_codes ADD COLUMN next TEXT;

CREATE INDEX login_codes_link ON login_codes (link_hash);
