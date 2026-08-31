// Dafny specification for UI state verification
// Models UI state as a map from field names to UI values and provides validation predicates.

datatype UIState = UIState(fields: map<string, UIValue>)

datatype UIValue =
  UIString(s: string) |
  UINumber(n: int) |
  UIBool(b: bool) |
  UIObject(o: map<string, UIValue>) |
  UIArray(a: seq<UIValue>) |
  UINull

// Predicate to ensure every field in the UIState has a valid UIValue.
predicate ValidState(state: UIState) {
  forall k :: k in state.fields.Keys ==> ValidValue(state.fields[k])
}

// Recursive predicate that validates a UIValue and its nested components.
predicate ValidValue(v: UIValue) {
  match v {
    case UIString(s) => true
    case UINumber(n) => true
    case UIBool(b) => true
    case UIObject(o) => forall k :: k in o.Keys ==> ValidValue(o[k])
    case UIArray(a) => forall i :: 0 <= i < |a| ==> ValidValue(a[i])
    case UINull => true
  }
}

// Method that verifies a UIState and returns a boolean indicating validity.
method VerifyUIState(state: UIState) returns (valid: bool)
  ensures valid ==> ValidState(state)
{
  valid := ValidState(state);
}
