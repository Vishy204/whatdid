mod lexer;
mod parser;

pub fn run(input: &str) -> usize {
    parser::Parser::new().parse(input)
}
