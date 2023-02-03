cmake_minimum_required(VERSION 3.25)

project(pear_stdio C)

include(pear)

add_pear_module(pear_stdio)

target_sources(
  pear_stdio
  PRIVATE
    binding.c
)
