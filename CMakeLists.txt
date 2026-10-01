cmake_minimum_required(VERSION 4.0)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)

project(bare_pipe C)

add_bare_module(bare_pipe)

target_sources(
  ${bare_pipe}
  PRIVATE
    binding.c
)

if(WIN32)
  target_link_libraries(
    ${bare_pipe}
    PRIVATE
      ntdll
  )
endif()

if(LINUX OR ANDROID)
  target_compile_definitions(
    ${bare_pipe}
    PRIVATE
      _GNU_SOURCE
  )
endif()
