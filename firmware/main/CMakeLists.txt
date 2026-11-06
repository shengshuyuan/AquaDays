idf_component_register(
    SRCS "main.c" "aqua_game.c" "aqua_render.c" "aqua_sound.c"
    INCLUDE_DIRS "."
    REQUIRES bsp esp_lcd esp_timer
    EMBED_FILES "../../prototype/assets/background.rgb565"
                "../../prototype/assets/background-night.rgb565"
                "../../prototype/assets/fish.rgb565a8"
                "../../prototype/assets/font-1bpp.bin"
)
