// Dafny specification for diagram verification
// Represents a diagram with nodes and edges and provides validation predicates.

datatype Diagram = Diagram(nodes: seq<Node>, edges: seq<Edge>)

datatype Node = Node(id: string, label: string, type: string)

datatype Edge = Edge(id: string, source: string, target: string, label: string)

// Predicate that ensures the diagram has at least one node, node ids are unique, and every edge connects existing nodes.
predicate ValidDiagram(d: Diagram) {
  |d.nodes| > 0 &&
  // node ids are unique
  forall i, j :: 0 <= i < |d.nodes| && 0 <= j < |d.nodes| && i != j ==> d.nodes[i].id != d.nodes[j].id &&
  // every edge's source and target refer to some node id
  forall e :: e in d.edges ==> (
    exists n :: n in d.nodes && n.id == e.source) &&
    (exists n :: n in d.nodes && n.id == e.target)
}

// Method that verifies a Diagram and returns a boolean indicating validity.
method VerifyDiagram(d: Diagram) returns (valid: bool)
  ensures valid ==> ValidDiagram(d)
{
  valid := ValidDiagram(d);
}
