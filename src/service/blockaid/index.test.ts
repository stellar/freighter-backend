import { Networks, TransactionBuilder, xdr } from "stellar-sdk";

/**
 * Envelope-parsing coverage across the full `SorobanCredentialsType` union.
 *
 * `TransactionBuilder.fromXDR` is on the hot path for any service that has to
 * inspect a submitted transaction, and the union gained two arms in Protocol 24
 * (`addressV2`, `addressWithDelegates`) that earlier SDK majors did not model.
 * These assertions pin that our SDK understands all four, so a future downgrade
 * or a stale transitive resolution is caught here rather than at runtime.
 *
 * A pinned base64 envelope is used rather than one built at test time so that
 * this keeps asserting against a fixed wire payload, the way a dapp-supplied
 * XDR reaches us.
 */

// invokeHostFunction with a single auth entry using
// sorobanCredentialsAddressV2, pubnet.
const CAP_71_TX_XDR =
  "AAAAAgAAAABlS+X153OjBcjFsqjqBklkcnoQo+noZmER6o5FWaTRdwAAAGQAAAAAAAAAAgAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABNj6qOGeEH7rQ9O2Ix3nk/mblaiRw3JjA7JwHPQXHsQMAAAAIdHJhbnNmZXIAAAAAAAAAAQAAAAIAAAAAAAAAAGVL5fXnc6MFyMWyqOoGSWRyehCj6ehmYRHqjkVZpNF3AAAAAAAAACoAAAPoAAAAAQAAAAAAAAABNj6qOGeEH7rQ9O2Ix3nk/mblaiRw3JjA7JwHPQXHsQMAAAAIdHJhbnNmZXIAAAAAAAAAAAAAAAAAAAAA";

const SOURCE = "GBSUXZPV45Z2GBOIYWZKR2QGJFSHE6QQUPU6QZTBCHVI4RKZUTIXPIQ7";

describe("CAP-71 envelope parsing", () => {
  it("knows the Protocol 24 SorobanCredentialsType arms", () => {
    expect(Object.keys(xdr.SorobanCredentialsType)).toEqual(
      expect.arrayContaining([
        "sorobanCredentialsSourceAccount",
        "sorobanCredentialsAddress",
        "sorobanCredentialsAddressV2",
        "sorobanCredentialsAddressWithDelegates",
      ]),
    );
  });

  it("parses an envelope carrying sorobanCredentialsAddressV2 auth", () => {
    const tx = TransactionBuilder.fromXDR(CAP_71_TX_XDR, Networks.PUBLIC);

    // Callers read the source account off the parsed envelope, so it has to
    // survive the round trip.
    expect(
      "innerTransaction" in tx ? tx.innerTransaction.source : tx.source,
    ).toEqual(SOURCE);
  });

  it("round-trips the envelope without dropping the V2 credentials", () => {
    const tx = TransactionBuilder.fromXDR(CAP_71_TX_XDR, Networks.PUBLIC);
    expect(tx.toXDR()).toEqual(CAP_71_TX_XDR);

    const [op] = tx.toEnvelope().v1().tx().operations();
    const [authEntry] = op.body().invokeHostFunctionOp().auth();
    expect(authEntry.credentials().switch().name).toEqual(
      "sorobanCredentialsAddressV2",
    );
  });
});
