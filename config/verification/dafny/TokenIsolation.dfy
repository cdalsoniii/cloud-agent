// Dual-account GitHub token isolation.
// BrightforestX org tokens must never be used for personal owners and vice versa.

module TokenIsolation {

  datatype OwnerKind = BrightforestOrg | Personal | Other

  function OwnerKindOf(owner: string): OwnerKind
  {
    if owner == "BrightforestX" || owner == "brightforestx" || owner == "Brightforest" then
      BrightforestOrg
    else if owner == "cdalsoniii" then
      Personal
    else
      Other
  }

  datatype TokenKind = OrgToken | PersonalToken | UnknownToken

  predicate Compatible(owner: OwnerKind, token: TokenKind)
  {
    match owner
      case BrightforestOrg => token == OrgToken
      case Personal => token == PersonalToken
      case Other => token != UnknownToken
  }

  method ResolveAllowed(owner: string, token: TokenKind) returns (allowed: bool)
    ensures allowed ==> Compatible(OwnerKindOf(owner), token)
  {
    var kind := OwnerKindOf(owner);
    if Compatible(kind, token) {
      return true;
    }
    return false;
  }

  predicate IsOrgOrPersonal(k: OwnerKind)
  {
    k == BrightforestOrg || k == Personal
  }

  method NeverCrossContaminate(ownerA: string, tokenA: TokenKind, ownerB: string, tokenB: TokenKind)
    returns (ok: bool)
    // Distinct org/personal owners must not share the same resolved token kind.
    ensures ok ==>
      (OwnerKindOf(ownerA) != OwnerKindOf(ownerB)
        && IsOrgOrPersonal(OwnerKindOf(ownerA))
        && IsOrgOrPersonal(OwnerKindOf(ownerB)))
        ==> tokenA != tokenB
  {
    var ka := OwnerKindOf(ownerA);
    var kb := OwnerKindOf(ownerB);
    if ka != kb && IsOrgOrPersonal(ka) && IsOrgOrPersonal(kb) {
      if tokenA == tokenB {
        return false;
      }
    }
    return true;
  }
}
