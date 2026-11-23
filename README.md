# Fabula Ultima Shop & Economy

A JRPG-style shop for the Project FU system (Foundry v13, Project FU 4.14+), built around Fabula Ultima's economy. Works on its own; with Fabula Ultima Battle UI installed it plays the same FFXIII / FFVII menu sounds.

## Install
In Foundry: Add-on Modules → Install Module → paste this Manifest URL:
`https://github.com/EclipseGS27/fu-shopmenu/releases/latest/download/module.json`

## Set up a merchant (GM)
1. Create a **Stash** actor (Project FU) and tick **Merchant** on its sheet. Its **price rate** and **IP recharge** cost stay on that sheet, as Project FU defines them.
2. Click **Shop setup** in the sheet header: kind of shop, greeting, prices, services and stock.
3. Click **Restock** for level-appropriate stock, or drag items onto the merchant yourself (both work together).
4. Click **Open for players**: the shop window opens for everyone, and stays reachable from the **Shops** button in the token controls until you untick "Open".

## Shopping
- **Shopping as**: pick which of your characters is buying. The header shows their zenit, the party's zenit and, for Merchants, their Trade Points.
- **Pay with** your own zenit or **party funds**, and **send to** your bag or the **party stash** (the active Party actor). Party-wide shopping is just that: anyone in the party can spend the party's money and fill the stash.
- **Buy**: filter by Weapons, Armor, Shields, Accessories, Items, or search. Each row shows the price (struck-through list price when a discount applies) and ▲ / ▼ / = for better, worse or about the same as what the buyer has equipped. Prices you can't afford turn red.
- **Compare before buying**: the item panel shows its stats and quality next to the equipped item in the same slot (Accuracy, Damage, DEF, M.DEF, INIT, with the difference), and warns when the buyer's classes don't grant that martial gear.
- **Sell**: everything the merchant would buy from your bag or the party stash, at the merchant's rate (50% of the list price by default). Equipped items are listed but have to be unequipped first.
- **Buy back**: anything sold here can be bought back for the same price until the GM restocks or starts a new visit.
- **Services**: **restock Inventory Points** (missing IP × the merchant's recharge rate, 10 zenit by default), and **stay at the inn** (price per person, everyone picked recovers all HP and MP through Project FU's own rest, without IP).
- **Haggle**: once per visit, roll a Check (INS + WLP to persuade, INS + INS to appraise, WLP + WLP, DEX + INS or MIG + WLP) against the merchant's Difficulty. 10% off on a success, 15% with 5 to spare, 20% on a critical, nothing on a failure, and a 10% markup on a fumble. The roll is made on the GM's side and posted to chat.

## Merchant class
- **Winds of Trade**: a Merchant with Trade Points gets a **2 Trade Points** button on rare items worth up to their level × 30 zenit, as the skill allows. The points come off the skill.
- **Merchant in the party** (world setting, homebrew, 10% by default): when the buyer or anyone in the party has the Merchant class, prices drop.

## Stock generation
**Restock** takes every basic item the shop deals in from Project FU's Basic Equipment compendium, plus rare items from the Rare Equipment compendium priced up to **300 + level × 60** zenit (600 at level 5, 1500 at level 20, all of them by level 34). The **Party level** button fills in the party's average level. Kinds: General store, Weaponsmith, Armorer, Jeweler (accessories), Magic shop (accessories and arcane or elemental weapons), Alchemist (Inventory Points only) and Inn. Restocking replaces only what was generated before; items you added by hand stay.

## Prices
List price × the merchant's price rate (Project FU), then the shop's discount, the Merchant discount and the haggled deal. Every purchase and sale runs on the GM's client and the price is worked out again there, so a player's window can't set its own price. A merchant can also use **its own zenit** (setup option): it gets paid when it sells and can run out of money when it buys.

## Settings
World: Merchant in the party discount, rare item price per level. Client: shop sounds.

Fonts: Antonio and PT Sans, SIL Open Font License (see fonts/).
