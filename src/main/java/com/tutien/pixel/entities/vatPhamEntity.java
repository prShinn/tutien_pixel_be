package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "vatPham")
public class vatPhamEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    private String name;
    @Column(unique = true)
    private String code;
    private String description;
    private String icon;
    @Enumerated(EnumType.STRING)
    private loaiTrangBi type;
    private int giaBan;
    private int giaMua;
    private int giaTriTuVi;
    @Enumerated(EnumType.STRING)
    private statsEmbed giaTriTang;
}
