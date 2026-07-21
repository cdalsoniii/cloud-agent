// Validation gate: PR publish requires validation pass.
// Mirrors pybatch ValidationEngine + create_pr gating.

module ValidationGate {

  datatype GateResult = Allowed | Blocked(reason: string)

  predicate ValidationPassed(validationOk: bool, hasValidationCmd: bool, cmdExit: int)
  {
    if hasValidationCmd then cmdExit == 0 else validationOk
  }

  method CanCreatePr(createPr: bool, validationOk: bool, hasValidationCmd: bool, cmdExit: int)
    returns (r: GateResult)
    ensures createPr && ValidationPassed(validationOk, hasValidationCmd, cmdExit)
      ==> r.Allowed?
    ensures createPr && !ValidationPassed(validationOk, hasValidationCmd, cmdExit)
      ==> r.Blocked?
    ensures !createPr ==> r.Blocked?
  {
    if !createPr {
      return Blocked("create_pr disabled");
    }
    if hasValidationCmd {
      if cmdExit != 0 {
        return Blocked("validation_cmd failed");
      }
      return Allowed;
    }
    if !validationOk {
      return Blocked("validation failed");
    }
    return Allowed;
  }

  method RequireFormalSuite(suite: string, pathsNonEmpty: bool)
    returns (ok: bool)
    requires |suite| > 0
    ensures ok ==> pathsNonEmpty
  {
    if !pathsNonEmpty {
      return false;
    }
    return true;
  }
}
