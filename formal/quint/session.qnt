module session {
  var open: bool
  var messages: int
  action Init = all {
    open' = false,
    messages' = 0
  }
  action Open = all {
    open == false,
    open' = true,
    messages' = messages
  }
  action Send = all {
    open == true,
    open' = true,
    messages' = messages + 1
  }
  action Close = all {
    open == true,
    open' = false,
    messages' = messages
  }
  action Next = any { Open, Send, Close }
  val MessagesNonNeg = messages >= 0
}