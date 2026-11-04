-- The creating app is now read from the discount's code (where apps such as Dotdigital and Loox record it) as well as
-- from the create event, so the discount index is built again from scratch.
DELETE FROM "DiscountIndexState";
DELETE FROM "DiscountIndex";
