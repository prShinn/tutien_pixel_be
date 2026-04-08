package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name="game_config")
public class GameConfigEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
}
