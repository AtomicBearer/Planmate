/* Actual INR ledger. Every calculation uses integer paise, never floating rupees. */
(function (root, factory) {
    if (typeof module === "object" && module.exports) module.exports = factory();
    else root.ExpenseRules = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    function migrate(s) {
        s.expenses ||= [];
        s.repayments ||= [];
        s.scrapbook ||= [];
        return s;
    }
    function paise(v, C, label = "Amount") {
        C.number(v, `${label} in paise`, 1, 100000000);
        C.check(Number.isSafeInteger(v), `${label} must use integer paise.`);
        return v;
    }
    function member(s, id, C) {
        C.check(
            s.members.some((m) => m.id === id),
            "Choose a member of this trip.",
        );
        return id;
    }
    function split(s, v, C) {
        const total = paise(v.amountPaise, C),
            people = v.participants;
        C.check(
            Array.isArray(people) && people.length > 0 && new Set(people).size === people.length,
            "Choose distinct participating members.",
        );
        people.forEach((id) => member(s, id, C));
        const ordered = s.members.filter((m) => people.includes(m.id)).map((m) => m.id),
            shares = {};
        if (v.split === "equal") {
            const each = Math.floor(total / ordered.length),
                extra = total % ordered.length;
            ordered.forEach((id, i) => (shares[id] = each + (i < extra ? 1 : 0)));
        } else {
            C.check(
                v.split === "custom" &&
                    v.shares &&
                    typeof v.shares === "object" &&
                    !Array.isArray(v.shares),
                "Choose equal or custom shares.",
            );
            C.check(
                Object.keys(v.shares).length === ordered.length &&
                    Object.keys(v.shares).every((id) => ordered.includes(id)),
                "Custom shares must include exactly the participants.",
            );
            for (const id of ordered) {
                C.number(v.shares[id], "Custom share in paise", 0, total);
                C.check(
                    Number.isSafeInteger(v.shares[id]),
                    "Custom shares must use integer paise.",
                );
                shares[id] = v.shares[id];
            }
            C.check(
                Object.values(shares).reduce((a, b) => a + b, 0) === total,
                "Custom shares must equal the expense total exactly.",
            );
        }
        return shares;
    }
    function balances(s) {
        const balance = Object.fromEntries(s.members.map((m) => [m.id, 0]));
        for (const e of s.expenses) {
            balance[e.payer] += e.amountPaise;
            for (const [id, n] of Object.entries(e.shares)) balance[id] -= n;
        }
        for (const r of s.repayments) {
            balance[r.from] += r.amountPaise;
            balance[r.to] -= r.amountPaise;
        }
        const debt = s.members
                .map((m) => ({ id: m.id, n: -balance[m.id] }))
                .filter((x) => x.n > 0)
                .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)),
            credit = s.members
                .map((m) => ({ id: m.id, n: balance[m.id] }))
                .filter((x) => x.n > 0)
                .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id)),
            suggested = [];
        let i = 0,
            j = 0;
        while (i < debt.length && j < credit.length) {
            const amount = Math.min(debt[i].n, credit[j].n);
            suggested.push({ from: debt[i].id, to: credit[j].id, amountPaise: amount });
            debt[i].n -= amount;
            credit[j].n -= amount;
            if (!debt[i].n) i++;
            if (!credit[j].n) j++;
        }
        return {
            balance,
            suggested,
            totalPaise: s.expenses.reduce((n, e) => n + e.amountPaise, 0),
        };
    }
    function owner(s, record, id, C) {
        C.check(
            record.by === id || s.organizerId === id,
            "Only the author or organizer can change this record.",
        );
    }
    function execute(s, cmd, id, C) {
        const v = cmd.payload || {},
            now = new Date().toISOString();
        switch (cmd.type) {
            case "addExpense":
            case "editExpense": {
                const existing = s.expenses.find((x) => x.id === v.id);
                if (cmd.type === "editExpense") {
                    C.check(existing, "Expense no longer exists.");
                    owner(s, existing, id, C);
                } else {
                    C.check(!existing, "Expense ID already exists.");
                    C.check(s.expenses.length < 500, "This trip has reached 500 expenses.");
                }
                const e = {
                    id: C.text(v.id, "Expense ID", 100),
                    description: C.text(v.description, "Description", 200),
                    amountPaise: paise(v.amountPaise, C),
                    payer: member(s, v.payer, C),
                    split: v.split,
                    shares: split(s, v, C),
                    by: existing?.by || id,
                    createdAt: existing?.createdAt || now,
                    updatedAt: existing ? now : null,
                };
                if (existing) s.expenses[s.expenses.indexOf(existing)] = e;
                else s.expenses.push(e);
                return true;
            }
            case "deleteExpense": {
                const e = s.expenses.find((e) => e.id === v.id);
                C.check(e, "Expense no longer exists.");
                owner(s, e, id, C);
                s.expenses = s.expenses.filter((x) => x.id !== e.id);
                return true;
            }
            case "addRepayment": {
                C.check(s.repayments.length < 500, "This trip has reached 500 repayment records.");
                C.check(!s.repayments.some((r) => r.id === v.id), "Repayment ID already exists.");
                const from = member(s, v.from, C),
                    to = member(s, v.to, C);
                C.check(from !== to, "Choose two different members.");
                s.repayments.push({
                    id: C.text(v.id, "Repayment ID", 100),
                    from,
                    to,
                    amountPaise: paise(v.amountPaise, C),
                    note: C.text(v.note || "", "Repayment note", 200, false),
                    by: id,
                    createdAt: now,
                });
                return true;
            }
            case "deleteRepayment": {
                const r = s.repayments.find((r) => r.id === v.id);
                C.check(r, "Repayment no longer exists.");
                owner(s, r, id, C);
                s.repayments = s.repayments.filter((x) => x.id !== r.id);
                return true;
            }
            case "editCaption":
            case "deletePhoto": {
                const photo = s.scrapbook.find((p) => p.id === v.id);
                C.check(photo, "Photo no longer exists.");
                C.check(photo.by === id, "Only the photo's author can change it.");
                if (cmd.type === "deletePhoto")
                    s.scrapbook = s.scrapbook.filter((p) => p.id !== photo.id);
                else {
                    photo.caption = C.text(v.caption || "", "Caption", 500, false);
                    photo.updatedAt = now;
                }
                return true;
            }
            default:
                return false;
        }
    }
    return { migrate, split, balances, execute };
});
