package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "canhGioi")
public class canhGioiEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private int stt;
    private String name;
    private int capDotPha;
}
