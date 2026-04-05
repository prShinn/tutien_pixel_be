package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "quest")
public class nhiemVuEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String name;
}
