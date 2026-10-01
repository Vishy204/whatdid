use crate::lexer::Token;

pub struct Parser {
    pos: usize,
}

impl Parser {
    pub fn new() -> Self { Parser { pos: 0 } }
    pub fn parse(&self, input: &str) -> usize { 0 }
}
